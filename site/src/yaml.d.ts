/* .yaml imports: the file's data, parsed at build time by the yaml plugin
 * in vite.config.ts. src/content.ts gives each file its type. */
declare module "*.yaml" {
  const data: unknown;
  export default data;
}
