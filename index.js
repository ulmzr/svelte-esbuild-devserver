const serve = require("devlrserver");
const esbuild = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin");
const svelte = require("svelte/compiler");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const cwd = process.cwd();
const watch = process.argv.includes("-w");
const env = fs.existsSync(path.join(cwd, "config.js")) ? require(path.join(cwd, "config.js")) : {};
const port = env.port || 8080;
const watchFiles = env.watch || "*.js";
const outdir = env.outdir || "public";
const esbuildConfig = env.esbuild || {};
const autoroute = env.autoroute;

serve({
   port,
   outdir,
   watch: watchFiles,
});

buildApp();
createRoutes();
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
   let ready;
   chokidar
      .watch(["src/components", "src/modules", "src/pages"], {
         ignored: /(^|[\/\\])\../,
         persistent: true,
         cwd,
      })
      .on("add", (pathname) => {
         if (!ready) return;
         createPages(pathname);
      })
      .on("change", (pathname) => {
         if (!ready) return;
         createPages(pathname);
      })
      .on("unlink", (pathname) => {
         if (!ready) return;
         createPages(pathname);
      })
      .on("unlinkDir", (pathname) => {
         if (!ready || !pathname.includes("pages")) return;
         createRoutes();
      })
      .on("addDir", (dirpath) => {
         if (!dirpath.includes("pages")) return;
         dirpath = dirpath.replace(/\\/g, "/");
         let content = 'export * from "../components";\nexport * from "../modules";\n';
         if (dirpath.match(/src\/pages\/\w+/)) {
            content = `export * from "../"`;
         }
         fs.writeFileSync(dirpath + "/index.js", content);
      })
      .on("ready", (path) => {
         ready = true;
      });
}

function createPages(filepath) {
   if (!filepath.endsWith(".svelte")) return;
   filepath = filepath.replaceAll("\\", "/");
   if (filepath.includes("src/pages")) {
      let p = filepath.replace("src/pages", "");
      p = p.split("/");
      let filename = p[p.length - 1];
      if (filename[0] !== "+") return;
      let dir = p.slice(0, -1);
      dir = dir[dir.length - 1];
      let dirpath = p.slice(0, -1).join("/");
      let files = getFiles(path.join("src/pages", dirpath));
      let pagesContent = "";
      files.map((file) => {
         if (!file.endsWith(".svelte")) return;
         let location = file.split("/");
         location = location[location.length - 1];
         if (location[0] !== "+") return;
         let cmp = location
            .replace(/\+|\.svelte/g, "")
            .replace(/\-/g, "_")
            .toLowerCase();
         pagesContent += `export { default as ${cmp.replace(/\-/g, "_")} } from "./${location}"\n`;
      });
      fs.writeFileSync(path.join("src/pages", dirpath, "pages.js"), pagesContent);
      pagesContent = `<script>
\timport * as pages from "./pages"; 
\timport { E404 } from "../";
\texport let params = {};\n
\tlet page;\n
\t$: params, page = Object.keys(params).length === 0 ? pages.home : pages[params.page.replace(/\-/g,'_')];
</script>\n
{#if page}
\t<svelte:component this={page} />
{:else}
\t<E404/>
{/if}
`;
      fs.writeFileSync(path.join("src/pages", dirpath, "Index.svelte"), pagesContent);
   } else if (filepath.includes("src/components") || filepath.includes("src/modules")) {
      let files = getFiles(filepath.split("/").slice(0, -1).join("/"));
      let content = "";
      files.map((f) => {
         let arr = f.split("/");
         let filename = arr[arr.length - 1];
         let match = filename.endsWith(".svelte") && filename[0].match(/[A-Z]/);
         if (match) {
            let cmp = filename.replace(".svelte", "");
            content += `export { default as ${cmp} } from "./${filename}";\n`;
         }
      });
      // console.log(">>>", filepath);
      fs.writeFileSync(filepath.split("/").slice(0, -1).join("/") + "/index.js", content);
   }

   createRoutes();
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

function createRoutes() {
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
            cmp2 = filepath.replace("/" + filename, "").split("/");
            cmp2 = cmp2[cmp2.length - 1] + cmp1;
         }
         result1 += `import ${cmp2 ? cmp2 : cmp1} from "${filepath.replace("src", ".")}";\n`;
         result2 += `\t{ path: "${pathname === "/home" ? "/" : pathname}", page: ${cmp2 ? cmp2 : cmp1} },\n`;
      }
   });
   result2 += "]";
   fs.writeFileSync("src/routes.js", result1 + result2);
}
