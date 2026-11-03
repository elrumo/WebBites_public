// Models often wrap JSON in ```json fences even in JSON mode, and JSON.parse chokes on them.
export function parseModelJson(raw: string) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return JSON.parse(fenced ? fenced[1] : raw);
}
