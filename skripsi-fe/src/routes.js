import About from "./pages/About.svelte";
import pageIndex from "./pages/config/pageIndex.svelte";
import Home from "./pages/Home.svelte";
export default [
	{ path: "/", page: Home },
	{ path: "/config/:page", page: pageIndex },
	{ path: "/about", page: About },
]