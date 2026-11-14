import { useCallback, useEffect, useState } from 'react';

// The app's pages live in the URL fragment (#/examples), so the browser's
// back and forward buttons move between them and any page can be linked to,
// with no server routing. The open canvas rides in its own route
// (#/canvas/<id>), so a refresh, the back button, or a pasted link restores
// it. A share link's fragment (#piece=…) isn't a route, so it lands on the
// canvas.

export type Route = 'canvases' | 'canvas' | 'waves' | 'examples' | 'guide' | 'instruments' | 'synth';
const PAGES: Route[] = ['canvases', 'waves', 'examples', 'guide', 'instruments', 'synth'];

export const routeHref = (route: Route, canvasId?: string | null) =>
  route === 'canvas' && canvasId ? `#/canvas/${canvasId}` : `#/${route}`;

const CANVAS_ID = /^#\/canvas\/(.+)$/;

export function parseRoute(hash: string): Route {
  const page = /^#\/([a-z]+)/.exec(hash)?.[1] as Route | undefined;
  return page && (page === 'canvas' || PAGES.includes(page)) ? page : 'canvas';
}

/** The canvas id in #/canvas/<id>, or null when the fragment is elsewhere. */
export const parseCanvasId = (hash: string): string | null => CANVAS_ID.exec(hash)?.[1] ?? null;

type RouteState = { route: Route; canvasId: string | null };

export function useRoute(): [Route, string | null, (route: Route, canvasId?: string | null) => void] {
  const read = (): RouteState => ({ route: parseRoute(location.hash), canvasId: parseCanvasId(location.hash) });
  const [state, setState] = useState<RouteState>(read);
  useEffect(() => {
    const sync = () => setState(read());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  const go = useCallback((next: Route, canvasId?: string | null) => {
    const href = routeHref(next, canvasId);
    if (location.hash === href) return;
    location.hash = href.slice(1);
    setState(read());
  }, []);
  return [state.route, state.canvasId, go];
}
