/** Whether a response with this Content-Type should be shown as text (vs. base64 binary). */
export function isTextualContentType(contentType: string): boolean {
  return /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|csv/i.test(contentType);
}
