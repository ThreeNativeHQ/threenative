/**
 * The "trusted by" wall. It renders only organisations that have given written permission, and
 * `permission` names where that permission is recorded. Until an entry exists the section is
 * omitted entirely: inventing customer logos is not a placeholder, it is a false statement about
 * real companies.
 */
export interface ILogo {
  readonly name: string;
  /** Path under `public/` to the mark supplied by the organisation. */
  readonly mark: string;
  /** Where the written permission to display this mark is recorded. Never empty. */
  readonly permission: string;
}

export const logos: readonly ILogo[] = [];
