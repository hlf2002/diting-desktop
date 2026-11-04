Object.assign(globalThis, {
  APP_NAME: "Diting",
  ELECTRON: false,
})

try {
  void __DEV__
} catch {
  Object.assign(globalThis, {
    __DEV__: process.env.NODE_ENV === "development",
  })
}
