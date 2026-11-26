/** The page the person was on before they opened Support, so staff can see where it happened.
 *  Only the path is kept (never a query or fragment, which can carry a token). */
let last = "";
export const rememberPage = (path: string) => {
  if (!path.startsWith("/support")) last = path.split("?")[0].split("#")[0];
};
export const lastPage = () => last;
