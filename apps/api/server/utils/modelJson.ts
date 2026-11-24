// Models often wrap JSON in ```json fences even in JSON mode, and JSON.parse chokes on them.
// MiMo also sometimes leaks a stray token after the object (`{...}<`), so fall back to the
// outermost {...} / [...] span. A truncated reply has no closer and still throws.
export function parseModelJson(raw: string) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = (fenced ? fenced[1] : raw).trim();
    try {
        return JSON.parse(text);
    } catch (error) {
        const start = text.search(/[{[]/);
        const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
        if (start === -1 || end <= start) throw error;
        return JSON.parse(text.slice(start, end + 1));
    }
}
