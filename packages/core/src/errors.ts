/** An error whose message is safe to show to the user; `status` is the HTTP status for the API. */
export class UserError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
