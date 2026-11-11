/**
 * A request the service refused or could not answer. `kind` is the problem kind the service sent,
 * such as `not-found`, or `unavailable` when the service did not answer at all.
 */
export class SbudError extends Error {
	constructor(
		readonly kind: string,
		readonly title: string,
		readonly status?: number,
	) {
		super(title);
		this.name = "SbudError";
	}
}
