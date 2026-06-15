import OpenAI from "openai";
import {
  getChatRequestTimeoutMs,
  isOpenAiConfigured,
} from "@/lib/ai/config";

function getOpenAIClient(): OpenAI {
  if (!isOpenAiConfigured()) {
    throw new Error("OpenAI API key is not configured");
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: getChatRequestTimeoutMs(),
  });
}

export async function openaiChatJson(
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; model: string }> {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI chat model");
  }

  return { content, model };
}
