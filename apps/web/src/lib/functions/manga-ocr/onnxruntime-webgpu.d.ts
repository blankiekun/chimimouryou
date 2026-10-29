// tsconfig's moduleResolution "node" ignores package exports; the webgpu entry shares the main types.d.ts.
declare module 'onnxruntime-web/webgpu' {
  export * from 'onnxruntime-web';
}
