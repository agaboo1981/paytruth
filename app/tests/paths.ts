/** GitHub Pages / Next static export is served under this basePath. */
export const BASE_PATH = '/paytruth';

/** Turn an app-relative path (e.g. `/verify?invoice=…`) into a Playwright URL path. */
export function appPath(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const [pathname, search] = path.split('?');
  const withSlash = pathname.endsWith('/') || pathname === '' ? pathname : `${pathname}/`;
  const prefixed = `${BASE_PATH}${withSlash.startsWith('/') ? withSlash : `/${withSlash}`}`;
  return search !== undefined ? `${prefixed}?${search}` : prefixed;
}
