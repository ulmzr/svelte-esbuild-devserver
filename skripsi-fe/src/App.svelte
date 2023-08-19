<script>
   import { onDestroy } from "svelte";
   import Router from "spa-trouter";
   import routes from "./routes.js";

   import { E404 } from "./modules";

   let cmp, params;

   const router = Router(routes, E404, (page, obj) => {
      cmp = page;
      params = obj;
   });

   router.listen();

   onDestroy(() => router.unlisten());
</script>

<aside>
   <h4>Menu</h4>
   <ul>
      <li><a href="/">Home</a></li>
      <li><a href="/about">About</a></li>
      <li><a href="/config/system">Config</a></li>
   </ul>
</aside>

{#if cmp}
   <main>
      <svelte:component this={cmp} {params} />
   </main>
{/if}

<style>
   aside {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      width: 16em;
      border-right: 1px solid #dadce0;
   }

   main {
      margin-left: 16em;
   }
</style>
