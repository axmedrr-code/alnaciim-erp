import { describe, it, expect } from 'vitest';
import { ROUTE_ROLES, canAccess } from '../utils/routeAccess';
import { ROUTES, EXPECTED } from '../test/accessMatrix';



describe('route access table', () => {
  for (const [role, allowed] of Object.entries(EXPECTED)) {
    it(`${role} can open exactly the expected pages`, () => {
      const actual = ROUTES.filter((p) => canAccess(role, p));
      expect(actual.sort()).toEqual([...allowed].sort());
    });
  }

  it('every signed-in role can open the dashboard', () => {
    for (const role of Object.keys(EXPECTED)) expect(canAccess(role, '/')).toBe(true);
  });

  it('an unknown role only gets the pages open to everyone', () => {
    const actual = ['/', ...ROUTES].filter((p) => canAccess('Intruder', p));
    expect(actual.sort()).toEqual(['/', '/requisitions']);
    expect(canAccess(undefined, '/finance')).toBe(false);
  });

  it('every page of the app has an entry in the table', () => {
    for (const p of ROUTES) expect(Object.prototype.hasOwnProperty.call(ROUTE_ROLES, p)).toBe(true);
  });
});
