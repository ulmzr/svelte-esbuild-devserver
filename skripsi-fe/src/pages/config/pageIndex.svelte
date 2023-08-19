<script>
   import * as pages from "./pages.js";
   import { E404 } from "../";
   export let params = {};

   const page = pages[params.page];
</script>

{#if page}
   <svelte:component this={page} />
{:else}
   <E404 />
{/if}
