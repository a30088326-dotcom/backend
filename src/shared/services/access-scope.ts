/** Accept both legacy UI and newer API scope names without changing their meaning. */
export const isOrganizationScope = (scope: unknown) => scope === 'ALL' || scope === 'ORGANIZATION';
