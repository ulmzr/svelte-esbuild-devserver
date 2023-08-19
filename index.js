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
         addDeleteFile(pathname);
      })
      .on("unlink", (pathname) => {
         if (!ready) return;
         addDeleteFile(pathname);
      })
      .on("addDir", (dir) => {
         if (!ready) return;
         dir = dir.replace(/\\/g, "/");
         if (!dir.includes("/pages/") && dir === "src/pages") return;
         createRoutes();
         if (!fs.existsSync(path.join(dir, "pages.js"))) fs.writeFileSync(path.join(dir, "pages.js"), "");
         if (!fs.existsSync(path.join(dir, "pageIndex.svelte"))) {
            let content = `<script>\n\timport * as pages from "./pages.js";\n\texport let params = {};\n\tconst page = pages[params.page];\n</script>\n\n{#if page}\n\t<svelte:component this={page} />\n{:else}\n{/if}\n `;
            fs.writeFileSync(path.join(dir, "pageIndex.svelte"), content);
         }
      })
      .on("unlinkDir", (path) => {
         if (!ready || !path.includes("pages")) return;
         createRoutes();
      })
      .on("ready", (path) => {
         ready = true;
      });
}

function addDeleteFile(pathname) {
   createRoutes();
   pathname = pathname.replace(/\\/g, "/");
   if (!pathname.endsWith(".svelte")) return;
   let dir = /.*(?<=\/)/.exec(pathname)[0];
   if (dir[dir.length - 1] === "/") dir = dir.slice(0, -1);
   let _files = getCmp(dir);
   let files = _files.filter((x) => {
      return !x.includes("/+");
   });
   let pages = _files.filter((x) => {
      return x.includes("/+");
   });
   files = files.join("");
   pages = pages.join("");
   if (dir.includes("pages")) {
      if (dir === "src/pages") {
         files += 'export * from "../components";\nexport * from "../modules";\n';
      } else files += 'export * from "../";\n';
      if (files) fs.writeFileSync(path.join(dir, "index.js"), files);
      if (pages) fs.writeFileSync(path.join(dir, "pages.js"), pages);
   } else fs.writeFileSync(path.join(dir, "index.js"), files);
}

function getCmp(dir, recursive = 0) {
   let res = getFiles(dir, recursive);
   res = res
      .filter((x) => x.endsWith(".svelte") && !x.includes("pageIndex.svelte"))
      .map((x) => {
         let cmp = /(\w+).svelte/g.exec(x);
         x = `export { default as ${cmp[1]} } from ".${x.replace(dir, "")}";\n`;
         return x;
      });
   return res;
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
   if (!autoroute) return;
   let files = getFiles("src/pages", 1);
   files = files.filter((x) => {
      let f = x.split("/").slice(-1)[0];
      return x.includes("pageIndex.svelte") || x.includes("Home.svelte") || f[0].match(/[A-Z]/);
   });
   files = files.map((x) => {
      let cmp = x.split("/").slice(-1)[0].replace(".svelte", "");
      let content = [
         `import ${cmp} from "${x.replace("src/", "./")}";`,
         cmp === "Home" ? "/" : x.replace("pageIndex.svelte", ":page"),
         cmp,
      ];
      return content;
   });

   let content = "";
   for (let i = 0; i < files.length; i++) {
      content += files[i][0] + "\n";
   }

   files = files.reverse();
   content += "export default [\n";
   for (let i = 0; i < files.length; i++) {
      content +=
         '\t{ path: "' +
         files[i][1].replace(/src\/pages|.svelte/g, "").toLowerCase() +
         '", ' +
         "page: " +
         files[i][2] +
         " },\n";
   }
   content += "]";

   fs.writeFileSync("src/routes.js", content);
}
