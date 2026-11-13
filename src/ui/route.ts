import { useCallback, useEffect, useState } from 'react';

// The app's pages live in the URL fragment (#/examples), so the browser's
// back and forward buttons move between them and any page can be linked to,
// with no server routing. A share link's fragment (#piece=…) isn't a route,
// so it lands on the canvas.

export type Route = 'canvases' | 'canvas' | 'waves' | 'examples' | 'guide' | 'instruments';
const PAGES: Route[] = ['canvases', 'waves', 'examples', 'guide', 'instruments'];

export const routeHref = (route: Route) => (route === 'canvas' ? '#/' : `#/${route}`);

export function parseRoute(hash: string): Route {
  const page = /^#\/([a-z]+)/.exec(hash)?.[1] as Route | undefined;
  return page && PAGES.includes(page) ? page : 'canvas';
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const sync = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  const go = useCallback((next: Route) => {
    if (parseRoute(location.hash) === next) return;
    location.hash = routeHref(next).slice(1);
    setRoute(next);
  }, []);
  return [route, go];
}
