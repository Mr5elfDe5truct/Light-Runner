// The hershey package ships plain CommonJS without type declarations.
declare module 'hershey/lib/rowmans.js' {
  const font: string;
  export default font;
}
declare module 'hershey/lib/characterNumbers.js' {
  const numbers: Record<string, number>;
  export default numbers;
}
