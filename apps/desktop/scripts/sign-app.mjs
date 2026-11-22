import { sign } from "@electron/osx-sign"

const identity =
  process.env.OSX_SIGN_IDENTITY ??
  "Developer ID Application: Shooter Technology (Zhuhai) Co., Ltd (FY4X5PTS6Q)"
const appPath = process.argv[2] ?? "out/diting-darwin-arm64/diting.app"

console.log("[sign] identity:", identity)
console.log("[sign] app:", appPath)

await sign({
  app: appPath,
  identity,
  identityValidation: true,
  hardenedRuntime: true,
  entitlements: "build/entitlements.mac.plist",
  // 只签 rsshub-runtime 里的原生二进制（Mach-O），避免逐文件签名把打包时间拉满。
  // 必须包含 bin/ 下的可执行文件（obscura、esbuild）：漏签任何一个都会被公证判 Invalid。
  ignore: (filePath) =>
    filePath.includes("rsshub-runtime") && !/(?:\.node|\.dylib)$|\/bin\/[^/]+$/.test(filePath),
})

console.log("[sign] done")
