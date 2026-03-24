const MAX_CONTENT_BYTES = 4096;

export interface WecomWebhookResponse {
  errcode?: number;
  errmsg?: string;
}

function splitContentByBytes(content: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(content).length <= maxBytes) {
    return [content];
  }

  const chunks: string[] = [];
  const lines = content.split("\n");
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (encoder.encode(candidate).length > maxBytes) {
      if (current) {
        chunks.push(current);
        current = line;
      } else {
        // single line exceeds limit, split by chars
        let part = "";
        for (const char of line) {
          const next = part + char;
          if (encoder.encode(next).length > maxBytes) {
            chunks.push(part);
            part = char;
          } else {
            part = next;
          }
        }
        current = part;
      }
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export async function sendWecomNotification(
  webhookKey: string,
  content: string,
) {
  const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${webhookKey}`;
  const chunks = splitContentByBytes(content, MAX_CONTENT_BYTES);
  const results = [];

  for (const chunk of chunks) {
    const webhookRes = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msgtype: "markdown_v2",
        markdown_v2: {
          content: chunk,
        },
      }),
    });
    results.push(await webhookRes.json());
  }

  return results.length === 1 ? results[0] : results;
}

export function isWecomNotificationSuccessful(
  result: WecomWebhookResponse | WecomWebhookResponse[],
) {
  const items = Array.isArray(result) ? result : [result];

  return items.every((item) => item?.errcode === 0);
}

export async function sendWecomImageByBase64(
  webhookKey: string,
  base64Data: string,
  md5: string,
) {
  const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${webhookKey}`;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      msgtype: "image",
      image: {
        base64: base64Data,
        md5,
      },
    }),
  });

  return res.json();
}
