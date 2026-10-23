const test = require('node:test'), assert = require('node:assert/strict');
const cashier = require('../lib/services/joyworldMemberCardService');
const { withLiveMemberStatus } = require('../lib/services/memberLookupStatus');
const member = { uid: 'account', phone: '270826001', balances: { points: 5 } };

test('disabled profiles remain visible with explicit status and unchanged balances', async () => {
  const requests = [];
  cashier.cashierRequest = async request => {
    requests.push(request);
    return { success: true, data: { shopId: 1, isEnabled: false } };
  };
  const result = await withLiveMemberStatus(member, 1);
  assert.deepEqual(result, { ...member, isEnabled: false });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, undefined);
  assert.equal(requests[0].query.memberAcctId, member.uid);
});
test('enabled, missing and unavailable status are distinct', async () => {
  cashier.cashierRequest = async () => ({ data: { shopId: 1, isEnabled: true } });
  assert.equal((await withLiveMemberStatus(member, 1)).isEnabled, true);
  cashier.cashierRequest = async () => ({ data: { shopId: 1 } });
  assert.equal((await withLiveMemberStatus(member, 1)).isEnabled, null);
  cashier.cashierRequest = async () => { throw Error('Status unavailable'); };
  assert.deepEqual(await withLiveMemberStatus(member, 1), { ...member, isEnabled: null });
});
test('status from another shop is rejected', async () => {
  cashier.cashierRequest = async () => ({ data: { shopId: 2, isEnabled: true } });
  await assert.rejects(() => withLiveMemberStatus(member, 1), e => e.code === 'permission-denied');
});
