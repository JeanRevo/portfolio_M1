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

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
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
        const endpoint =
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const geminiResponse = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [
                        {
                            text: systemPrompt
                        }
                    ]
                },
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                text: userInput
                            }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.45
                }
            })
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();

            return res.status(geminiResponse.status).json({
                error: "Gemini API error",
                details: errorText
            });
        }

        const geminiData = await geminiResponse.json();

        const content =
            geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!content) {
            return res.status(500).json({
                error: "Empty Gemini response",
                raw: geminiData
            });
        }

        const parsed = JSON.parse(content);

        return res.status(200).json(parsed);

    } catch (error) {
        return res.status(500).json({
            error: "Server error",
            details: error.message
        });
    }
}