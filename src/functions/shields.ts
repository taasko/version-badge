import querystring from "querystring";
import { APIGatewayEvent, ProxyResult } from "aws-lambda";
import { getVersion, InvalidArgumentException } from "../versions";

export async function handler(event: APIGatewayEvent): Promise<ProxyResult> {
  try {
    const [versionRaw, lang] = event.path.split("/").reverse();
    const version = querystring.unescape(versionRaw);

    const result = getVersion(lang, version);

    if (!result) {
      return { statusCode: 404, body: `Version not found` };
    }

    // Docs: https://shields.io/endpoint
    return {
      statusCode: 200,
      body: JSON.stringify({
        schemaVersion: 1,
        label: `${lang} ${version}`,
        message: result.eol,
        color: result.isEol ? "critical" : "success",
        cacheSeconds: 60 * 60 * 24,
      }),
    };
  } catch (err) {
    if (err instanceof InvalidArgumentException) {
      return { statusCode: 400, body: err.message };
    }

    return { statusCode: 500, body: err.toString() };
  }
}