import {auditFetch} from './transport.mjs';
if(process.env.ZEER_PUBLIC_METER_URL)globalThis.fetch=auditFetch({
  origin:'https://zeer.endpx.cloud/api/prep',coordinator:process.env.ZEER_PUBLIC_METER_URL,
  token:process.env.ZEER_PUBLIC_METER_TOKEN,client:process.env.ZEER_PUBLIC_CLIENT,
});
