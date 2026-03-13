export async function sendWecomNotification(
	webhookKey: string,
	content: string,
) {
	const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${webhookKey}`;

	const webhookRes = await fetch(webhookUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			msgtype: "markdown_v2",
			markdown_v2: {
				content,
			},
		}),
	});

	return webhookRes.json();
}
