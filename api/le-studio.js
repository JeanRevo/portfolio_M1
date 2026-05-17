export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    }

    let body = req.body;

    if (typeof body === "string") {
        body = JSON.parse(body);
    }

    const { userInput, systemPrompt } = body || {};

    if (!userInput || !systemPrompt) {
        return res.status(400).json({
            error: "Missing userInput or systemPrompt",
            receivedBody: body
        });
    }

    try {
        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                response_format: { type: "json_object" },
                temperature: 0.7,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userInput }
                ]
            })
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();

            return res.status(groqResponse.status).json({
                error: "Groq API error",
                details: errorText
            });
        }

        const groqData = await groqResponse.json();
        const content = groqData.choices?.[0]?.message?.content;

        if (!content) {
            return res.status(500).json({ error: "Empty Groq response" });
        }

        return res.status(200).json(JSON.parse(content));

    } catch (error) {
        return res.status(500).json({
            error: "Server error",
            details: error.message
        });
    }
}