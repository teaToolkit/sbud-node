/**
 * A request the service refused or could not answer. `kind` is the problem kind the service sent,
 * such as `not-found`, or `unavailable` when the service did not answer at all. `errors` lists every
 * faulty field when the kind is `invalid`.
 */
export class SbudError extends Error {
	constructor(
		readonly kind: string,
		readonly title: string,
		readonly status?: number,
		readonly errors: { field: string; message: string }[] = [],
	) {
		super(title);
		this.name = "SbudError";
	}
}
