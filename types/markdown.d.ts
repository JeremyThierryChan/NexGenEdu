/**
 * 让 data/site/content.md 成为真正的构建依赖。
 *
 * 数据层用 fs 读取该文件时，打包器不会把它算进依赖图，
 * 结果是 `npm run dev` 下修改 content.md 不会触发重新编译，
 * 必须重启开发服务器才能看到改动 —— 这对「改完刷新即见」的使用方式很不友好。
 *
 * 这里通过 webpack 的 raw-loader 把文件内容作为字符串导入：
 *   - 文件进入依赖图 → 保存后自动重新编译，刷新页面即生效
 *   - 生产构建在编译期把内容内联进产物，产物不再依赖运行时文件系统
 *
 * 这样「一个 Markdown 文件就是全部内容」的用法才真正成立。
 */

declare module "*.md" {
  const content: string;
  export default content;
}
