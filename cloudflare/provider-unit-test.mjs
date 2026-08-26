import assert from 'node:assert/strict';
import {
  buildSynchronizedMapsHotelUrl,
  compareProviderResults,
  parseGoogleMapsHotelUrl,
  parseTwdPrice,
} from './provider-utils.js';

const maps8800 = 'https://www.google.com/maps/search/%E9%A3%AF%E5%BA%97/@36.9219703,138.4445113,15.02z/data=!4m8!2m7!5m5!5m3!1s2027-01-15!4m1!1i2!9i8800!6e3?entry=ttu&g_ep=EgoyMDI2MDgyMy4wIKXMDSoASAFQAw%3D%3D';
const mapsThreeNights = 'https://www.google.com/maps/search/%E9%A3%AF%E5%BA%97/@36.9198798,138.4227535,13z/data=!4m9!2m8!5m6!5m4!1s2027-01-14!2i3!4m1!1i2!9i73750!6e3?entry=ttu';

{
  const parsed = parseGoogleMapsHotelUrl(maps8800);
  assert.equal(parsed.check_in, '2027-01-15');
  assert.equal(parsed.adults, 2);
  assert.equal(parsed.max_price_per_night, 8800);
  assert.equal(parsed.latitude, 36.9219703);
  assert.equal(parsed.longitude, 138.4445113);
}

{
  const parsed = parseGoogleMapsHotelUrl(mapsThreeNights);
  assert.equal(parsed.check_in, '2027-01-14');
  assert.equal(parsed.nights, 3);
  assert.equal(parsed.check_out, '2027-01-17');
  assert.equal(parsed.adults, 2);
}

{
  const synced = buildSynchronizedMapsHotelUrl(maps8800, {
    check_in: '2027-01-20',
    check_out: '2027-01-23',
    adults: 3,
    max_price_per_night: 6000,
  });
  const parsed = parseGoogleMapsHotelUrl(synced);
  assert.equal(parsed.check_in, '2027-01-20');
  assert.equal(parsed.check_out, '2027-01-23');
  assert.equal(parsed.adults, 3);
  assert.equal(parsed.max_price_per_night, 6000);
}

assert.equal(parseTwdPrice('$3,949'), 3949);
assert.equal(parseTwdPrice('NT$ 8,800'), 8800);
assert.equal(parseTwdPrice('$2.49萬'), 24900);
assert.equal(parseTwdPrice('4.9 ★★★★★ (22)'), null);

{
  const parity = compareProviderResults(
    [
      { name: 'HETA 蕾 Nozawa Onsen', nightly_price: 24900 },
      { name: 'ヴィラ美やもと', nightly_price: 3949 },
    ],
    [
      { name: 'HETA 蕾 Nozawa Onsen', nightly_price: 25000 },
      { name: 'ヴィラ美やもと', nightly_price: 4000 },
    ],
    'TWD',
  );
  assert.equal(parity.matched_count, 2);
  assert.equal(parity.gate.overlap_pass, true);
  assert.equal(parity.gate.price_pass, true);
}

console.log('ALL PROVIDER UNIT TESTS PASSED');
