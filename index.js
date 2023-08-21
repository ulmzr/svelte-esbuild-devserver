const serve = require("devlrserver");
const esbuild = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin");
const svelte = require("svelte/compiler");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const cwd = process.cwd();
const watch = process.argv.includes("-w");
const env = fs.existsSync(path.join(cwd, "config.js")) ? require(path.join(cwd, "config.js")) : {};
const port = env.port || 8080;
const watchFiles = env.watch || "*.js";
const outdir = env.outdir || "public";
const esbuildConfig = env.esbuild || {};
const autoroute = env.autoroute;

let ready;
const regex = /(.+[^\/])\/(\+.*.svelte)/;
const regexC = /(.+[^\/])\/([A-Z].*.svelte)/;
const exist = (filepath) => fs.existsSync(filepath);
const write = async (filepath, content) => await fsp.writeFile(filepath, content, "utf8");

serve({
   port,
   outdir,
   watch: watchFiles,
});

buildApp();
// createRoutes();
watching();

async function buildApp() {
   const ctx = await esbuild.context({
      entryPoints: ["src/main.js"],
      bundle: true,
      minify: !watch,
      format: "iife",
      outdir,
      plugins: [sveltePlugin(), sassPlugin()],
      ...esbuildConfig,
   });
   ctx.watch();
   if (!watch) ctx.dispose();
}

function sveltePlugin() {
   return {
      name: "svelte",
      setup(build) {
         build.onLoad({ filter: /\.svelte$/ }, async (args) => {
            // This converts a message in Svelte's format to esbuild's format
            let convertMessage = ({ message, start, end }) => {
               let location;
               if (start && end) {
                  let lineText = source.split(/\r\n|\r|\n/g)[start.line - 1];
                  let lineEnd = start.line === end.line ? end.column : lineText.length;
                  location = {
                     file: filename,
                     line: start.line,
                     column: start.column,
                     length: lineEnd - start.column,
                     lineText,
                  };
               }
               return { text: message, location };
            };

            // Load the file from the file system
            let source = await fsp.readFile(args.path, "utf8");
            let filename = path.relative(process.cwd(), args.path);

            // Convert Svelte syntax to JavaScript
            try {
               let { js, warnings } = svelte.compile(source, { filename });
               let contents = js.code + `//# sourceMappingURL=` + js.map.toUrl();
               return { contents, warnings: warnings.map(convertMessage) };
            } catch (e) {
               return { errors: [convertMessage(e)] };
            }
         });
      },
   };
}

function watching() {
   if (!watch) return;
   const chokidar = require("chokidar");
   chokidar
      .watch(["src/components", "src/modules", "src/pages"], {
         ignored: /(^|[\/\\])\../,
         persistent: true,
         cwd,
      })
      .on("ready", () => (ready = true))
      .on("change", (path) => createPagesJS(path))
      .on("add", (path) => createPagesJS(path))
      .on("unlink", (path) => createPagesJS(path))
      .on("unlinkDir", (path) => createRoutes(path))
      .on("addDir", async (dir) => {
         if (!dir.includes("pages")) return;
         dir = dir.replace(/\\/g, "/");
         let content = 'export * from "../components";\nexport * from "../modules";\n';
         if (dir.match(/src\/pages\/\w+/)) content = `export * from "../"`;
         await fsp.writeFile(dir + "/index.js", content, "utf8");
      });
}

function createIndexSvelte(pathname) {
   pathname = pathname.replaceAll("\\", "/");
   let isMatch = pathname.match(regex);
   if (isMatch) {
      let dirname = isMatch[1];
      if (!exist(dirname)) return;
      if (!exist(path.join(dirname, "Index.svelte"))) {
         write(
            path.join(
               dirname,
               "Index.svelte",
               `<script>
\timport * as pages from "./pages";
\timport { E404 } from "./";
\texport let params = {};\n
\tlet page = pages.home;\n
\t$: params, page = !params.page ? pages.home : pages[params.page?.replace(/[-+:]/g, "_")];
</script>\n
{#if page}
\t<svelte:component this={page}/>
{:else}
\t<E404/>
{/if}`
            )
         );
         createRoutes();
      }
   }
}

function createPagesJS(pathname) {
   // if (!ready) return;
   pathname = pathname.replaceAll("\\", "/");
   if (pathname.startsWith("src/pages")) {
      let isMatch = pathname.match(regex);
      if (isMatch) {
         let dirname = isMatch[1];
         if (!exist(dirname)) return;
         if (!exist(path.join(dirname, "+home.svelte"))) {
            write(path.join(dirname, "+home.svelte"), "");
         }
         let files = getFiles(dirname);
         files = files.filter((file) => file.match(regex));
         files = files.map((file) => {
            let filename = file.match(regex)[2];
            let cmp = filename
               .slice(1)
               .replace(".svelte", "")
               .replace(/[\-\+\:]/g, "_");
            return `export { default as ${cmp} } from "./${filename}"\n`;
         });
         write(path.join(dirname, "pages.js"), files.join(""));
         createIndexSvelte(pathname);
      }
   } else if (pathname.startsWith("src/components") || pathname.startsWith("src/modules")) {
      let isMatch = pathname.match(regexC);
      if (isMatch) {
         let dirname = isMatch[1];
         if (!exist(dirname)) return;
         let files = getFiles(dirname);
         files = files.filter((file) => file.match(regexC));
         files = files.map((file) => {
            let filename = file.match(regexC)[2];
            let cmp = filename.replace(".svelte", "").replace(/[\-\+\:]/g, "_");
            return `export { default as ${cmp} } from "./${filename}"\n`;
         });
         write(path.join(dirname, "index.js"), files.join(""));
      }
   }
}

function getFiles(dir, recursive = 0) {
   let res = [];
   let list = fs.readdirSync(dir);
   list.forEach(function (file) {
      file = dir + "/" + file;
      let stat = fs.statSync(file);
      if (stat && stat.isDirectory() && recursive) res = res.concat(getFiles(file, recursive));
      else res.push(file);
   });
   res = res.map((x) => {
      return x.replaceAll("\\", "/");
   });
   return res;
}

function createRoutes(pathname) {
   if (pathname && !pathname.includes("pages")) return;
   let files = getFiles("src/pages", 1);
   files = files.reverse();
   let result1 = "";
   let result2 = "\nexport default [\n";
   files = files = files.map((filepath) => {
      let filename = filepath.split("/");
      filename = filename[filename.length - 1];
      let match = filename.endsWith(".svelte") && filename[0].match(/[A-Z]/);
      if (match) {
         let cmp1 = filename.replace(".svelte", "");
         let pathname = filepath
            .replace(/.svelte|src\/pages/g, "")
            .toLowerCase()
            .replace("index", ":page");
         let cmp2;
         if (cmp1 === "Index") {
            cmp2 = filepath
               .replace("/" + filename, "")
               .split("/")
               .map((x) => x[0].toUpperCase() + x.slice(1));
            cmp2 = "page" + cmp2.slice(2).join("");
         }
         result1 += `import ${cmp2 ? cmp2 : cmp1} from "${filepath.replace("src", ".")}";\n`;
         result2 += `\t{ path: "${pathname === "/home" ? "/" : pathname}", page: ${cmp2 ? cmp2 : cmp1} },\n`;
      }
   });
   result2 += "]";
   fsp.writeFile("src/routes.js", result1 + result2, "utf8");
}
