/**
 * Runs in <head> before the first paint (layout.tsx): applies a saved light/dark
 * choice. Kept outside the client module so the server layout can inline it.
 */
export const THEME_BOOT = "(function(){try{var t=localStorage.getItem('fia_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();";
