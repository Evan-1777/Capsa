// vite.config.ts 运行在 Node 下，tsc 检查该文件时需要 process 的声明；
// 为这一个全局变量引入 @types/node 不划算，这里给出最小声明。
declare const process: { env: Record<string, string | undefined> };
