import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import type { NationalFetch } from "./national-law.js";

/**
 * Two state legislatures (Connecticut www.cga.ct.gov, Illinois www.ilga.gov) send only their own
 * certificate, without the CA that issued it. Browsers fetch the missing CA themselves (AIA); Node does
 * not. The issuing CAs below are public, taken from the AIA addresses in those certificates
 * (2026-11-09), and chain to roots already in Node's store: the chain is verified as usual, only the
 * missing link is supplied, and only for these hosts.
 */
const INTERMEDIATES = {
  // Go Daddy Secure Certificate Authority - G2 (http://certificates.godaddy.com/repository/gdig2.crt),
  // SHA-256 97:3A:41:27:6F:FD:01:E0:27:A2:AA:D4:9E:34:C3:78:46:D3:E9:76:FF:6A:62:0B:67:12:E3:38:32:04:1A:A6
  godaddyG2: `-----BEGIN CERTIFICATE-----
MIIE0DCCA7igAwIBAgIBBzANBgkqhkiG9w0BAQsFADCBgzELMAkGA1UEBhMCVVMx
EDAOBgNVBAgTB0FyaXpvbmExEzARBgNVBAcTClNjb3R0c2RhbGUxGjAYBgNVBAoT
EUdvRGFkZHkuY29tLCBJbmMuMTEwLwYDVQQDEyhHbyBEYWRkeSBSb290IENlcnRp
ZmljYXRlIEF1dGhvcml0eSAtIEcyMB4XDTExMDUwMzA3MDAwMFoXDTMxMDUwMzA3
MDAwMFowgbQxCzAJBgNVBAYTAlVTMRAwDgYDVQQIEwdBcml6b25hMRMwEQYDVQQH
EwpTY290dHNkYWxlMRowGAYDVQQKExFHb0RhZGR5LmNvbSwgSW5jLjEtMCsGA1UE
CxMkaHR0cDovL2NlcnRzLmdvZGFkZHkuY29tL3JlcG9zaXRvcnkvMTMwMQYDVQQD
EypHbyBEYWRkeSBTZWN1cmUgQ2VydGlmaWNhdGUgQXV0aG9yaXR5IC0gRzIwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC54MsQ1K92vdSTYuswZLiBCGzD
BNliF44v/z5lz4/OYuY8UhzaFkVLVat4a2ODYpDOD2lsmcgaFItMzEUz6ojcnqOv
K/6AYZ15V8TPLvQ/MDxdR/yaFrzDN5ZBUY4RS1T4KL7QjL7wMDge87Am+GZHY23e
cSZHjzhHU9FGHbTj3ADqRay9vHHZqm8A29vNMDp5T19MR/gd71vCxJ1gO7GyQ5HY
pDNO6rPWJ0+tJYqlxvTV0KaudAVkV4i1RFXULSo6Pvi4vekyCgKUZMQWOlDxSq7n
eTOvDCAHf+jfBDnCaQJsY1L6d8EbyHSHyLmTGFBUNUtpTrw700kuH9zB0lL7AgMB
AAGjggEaMIIBFjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNV
HQ4EFgQUQMK9J47MNIMwojPX+2yz8LQsgM4wHwYDVR0jBBgwFoAUOpqFBxBnKLbv
9r0FQW4gwZTaD94wNAYIKwYBBQUHAQEEKDAmMCQGCCsGAQUFBzABhhhodHRwOi8v
b2NzcC5nb2RhZGR5LmNvbS8wNQYDVR0fBC4wLDAqoCigJoYkaHR0cDovL2NybC5n
b2RhZGR5LmNvbS9nZHJvb3QtZzIuY3JsMEYGA1UdIAQ/MD0wOwYEVR0gADAzMDEG
CCsGAQUFBwIBFiVodHRwczovL2NlcnRzLmdvZGFkZHkuY29tL3JlcG9zaXRvcnkv
MA0GCSqGSIb3DQEBCwUAA4IBAQAIfmyTEMg4uJapkEv/oV9PBO9sPpyIBslQj6Zz
91cxG7685C/b+LrTW+C05+Z5Yg4MotdqY3MxtfWoSKQ7CC2iXZDXtHwlTxFWMMS2
RJ17LJ3lXubvDGGqv+QqG+6EnriDfcFDzkSnE3ANkR/0yBOtg2DZ2HKocyQetawi
DsoXiWJYRBuriSUBAA/NxBti21G00w9RKpv0vHP8ds42pM3Z2Czqrpv1KrKQ0U11
GIo/ikGQI31bS/6kA1ibRrLDYGCD+H1QQc7CoZDDu+8CL9IVVO5EFdkKrqeKM+2x
LXY2JtwE65/3YR8V3Idv7kaWKK2hJn0KCacuBKONvPi8BDAB
-----END CERTIFICATE-----`,
  // Sectigo Public Server Authentication CA OV R40 (http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR40.crt),
  // SHA-256 8E:B2:F1:7D:66:89:41:C3:9A:7F:CA:0C:EE:12:7A:E0:EB:AF:44:46:10:63:1C:CA:3C:D1:9E:AB:46:C5:82:4A
  sectigoOvR40: `-----BEGIN CERTIFICATE-----
MIIGOzCCBCOgAwIBAgIRAJtQo9lL5MczAhJFS8xoc3gwDQYJKoZIhvcNAQEMBQAw
XzELMAkGA1UEBhMCR0IxGDAWBgNVBAoTD1NlY3RpZ28gTGltaXRlZDE2MDQGA1UE
AxMtU2VjdGlnbyBQdWJsaWMgU2VydmVyIEF1dGhlbnRpY2F0aW9uIFJvb3QgUjQ2
MB4XDTI1MDUxNDAwMDAwMFoXDTQwMDUxMzIzNTk1OVowYDELMAkGA1UEBhMCR0Ix
GDAWBgNVBAoTD1NlY3RpZ28gTGltaXRlZDE3MDUGA1UEAxMuU2VjdGlnbyBQdWJs
aWMgU2VydmVyIEF1dGhlbnRpY2F0aW9uIENBIE9WIFI0MDCCAaIwDQYJKoZIhvcN
AQEBBQADggGPADCCAYoCggGBAIlSHqpFAFB5FVW5J1XfsOxTmd5YQvl3LTnrYYVf
eoamvgK7A71WHHX4RXMFelolbXULkHL2NwTGKHIiykTQTqnvSRaU0NAWGw/zTSbw
VK6TN2tw5Lhys2PF+nGJTXkii5fqTchwesB0Il/94vkbbvNIEN3i/4RoRDpIAqRP
SINzKOwhKrZ5yejAVM5gS0bOi8yn5j4c74PPEmr+qJ8rp04d9BEnXKGYQNk069f1
KTwlSgvc0n0ZmloYp6LUomjBYiX53jSYJAsmacshPUw5VZ6ti/tlVmTeq9yi0ICe
XJhStXMmH8zFut4hr3G77JTT1swJF+w0VnwMIhVuQKDmIpVmuJvgBsKB3ffS94C+
SilLXyWFt+zr7KMFKWg3ElsQRpJzqUYfeKZKQ04RIjBNf+eScSUebEpwV6tcf4mw
5tDisbAjgyn1ST5WlascokKYW93RMv6NinELJ5WEsO/J7OC8rw34H4YhyMJfUe68
ZmPaF6Q72NzBaoxpPROtUPn6CQIDAQABo4IBbzCCAWswHwYDVR0jBBgwFoAUVnNY
ZJX5khqwEioEYnmhQBWIIUkwHQYDVR0OBBYEFHviSaFgtLvoQubGp1QRHGFkU1XR
MA4GA1UdDwEB/wQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMBMGA1UdJQQMMAoG
CCsGAQUFBwMBMBMGA1UdIAQMMAowCAYGZ4EMAQICMFQGA1UdHwRNMEswSaBHoEWG
Q2h0dHA6Ly9jcmwuc2VjdGlnby5jb20vU2VjdGlnb1B1YmxpY1NlcnZlckF1dGhl
bnRpY2F0aW9uUm9vdFI0Ni5jcmwwgYQGCCsGAQUFBwEBBHgwdjBPBggrBgEFBQcw
AoZDaHR0cDovL2NydC5zZWN0aWdvLmNvbS9TZWN0aWdvUHVibGljU2VydmVyQXV0
aGVudGljYXRpb25Sb290UjQ2LnA3YzAjBggrBgEFBQcwAYYXaHR0cDovL29jc3Au
c2VjdGlnby5jb20wDQYJKoZIhvcNAQEMBQADggIBAFAufRwhEW91VWsDvjejAhWg
drPqDVSh7gNeo40fI+V2dT557ABemJ7/NnzylJvjX5bYeToiUGI+MladTJQL4aOB
glG2hfQXOT++PM9eM8+gztEzCoNdqe1phQA64DqulrabuzMUNQfUqTZJlswiGh3L
XZXyrxodS+G2duhPhuWIQTfIZHSSYjiFMsuZHFyjm+plHQDVhK7BI3fSrtFVny0q
gpolbiha1TuaCo6P7/7l5j54HBOLO7byq8uc9D83I9mW+ZLN9ZaC82maxdmvXWln
Ubc8BUClomt9iIxNLmwE3w9bp+0hFVHc+Ud6AI5ZFeTDQ+f6HNpDY26GXFAx48Sg
z+/+jDfGIDLhZ9cI8jGy2m+AR9T+K9JVszzyXrZI6P6VZGgHh8V+tZ5NDWG5yLLW
N+9pKKmkY4tpQ8Gmb26dnbdD+x+I7Y6S4Cc9HcstpM5v+wKt/JJly9eU31GHucfg
cd+G1b2BFuN5p0mLHh6t5R9MZG3xG3GEqNYSM5049FDOl5ZaMGRqk0uN31obMJ8w
mAzRNWgEm28ebPhbVgfCmcCxn06xdoZ8G1AkeSWwVzbH05tEK5ly2pWJ5QSzIW/c
Joxchdy1k8eXj0Eu0yaqlKZDh95Tlhuq37ZbFWwzynqUIvAYKjI8PQwIIR8EoOx8
M2A5O6N9rci7TeBnWdo+
-----END CERTIFICATE-----`
};

export const HOSTS_WITHOUT_INTERMEDIATE = /^(?:www\.)?(?:cga\.ct\.gov|ilga\.gov)$/u;

let agent: https.Agent | undefined;
function intermediateAgent(): https.Agent {
  // NODE_EXTRA_CA_CERTS (a corporate proxy's CA) stays trusted, as for every other request.
  const extra = process.env.NODE_EXTRA_CA_CERTS ? [readExtra(process.env.NODE_EXTRA_CA_CERTS)] : [];
  agent ??= new https.Agent({ ca: [...tls.rootCertificates, INTERMEDIATES.godaddyG2, INTERMEDIATES.sectigoOvR40, ...extra.filter(Boolean)], proxyEnv: process.env, keepAlive: false } as https.AgentOptions);
  return agent;
}

function readExtra(path: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** fetch for the hosts above: same answer shape as NationalFetch, redirects followed (5 at most). */
export const fetchWithIntermediates: NationalFetch = (address, init) =>
  new Promise((resolve, reject) => {
    const go = (target: string, hops: number): void => {
      const request = https.get(target, { agent: intermediateAgent(), headers: init.headers, ...(init.signal ? { signal: init.signal } : {}) }, (reply) => {
        const status = reply.statusCode ?? 0;
        if (status >= 300 && status < 400 && reply.headers.location && hops < 5) {
          reply.resume();
          go(new URL(reply.headers.location, target).href, hops + 1);
          return;
        }
        const chunks: Buffer[] = [];
        reply.on("data", (chunk: Buffer) => chunks.push(chunk));
        reply.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name: string) => { const value = reply.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(", ") : value ?? null; } },
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
          } as Awaited<ReturnType<NationalFetch>>);
        });
        reply.on("error", reject);
      });
      request.on("error", reject);
    };
    go(String(address), 0);
  });
