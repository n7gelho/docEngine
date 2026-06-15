import Anthropic from "@anthropic-ai/sdk";
import {
  getChatRequestTimeoutMs,
  getClaudeModel,
  isClaudeConfigured,
} from "@/lib/ai/config";

function getClaudeClient(): Anthropic {
  if (!isClaudeConfigured()) {
    throw new Error("Anthropic API key is not configured");
  }
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: getChatRequestTimeoutMs(),
  });
}

export async function claudeChatJson(
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; model: string }> {
  const client = getClaudeClient();
  const model = getClaudeModel();

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.1,
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";
  if (!content.trim()) {
    throw new Error("Empty response from Claude chat model");
  }

  return { content, model: `claude:${model}` };
}
