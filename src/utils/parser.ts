/**
 * Convert HTML to clean markdown
 */
export function htmlToMarkdown(html: string): string {
  let content = html;

  // Remove scripts, styles, and other non-content elements
  content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
  content = content.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  content = content.replace(/<header[\s\S]*?<\/header>/gi, "");
  content = content.replace(/<!--[\s\S]*?-->/g, "");

  // Convert headings
  content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  content = content.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  content = content.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Convert paragraphs and line breaks
  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  content = content.replace(/<br\s*\/?>/gi, "\n");
  content = content.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Convert lists
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  content = content.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  // Convert links
  content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert emphasis
  content = content.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  content = content.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  content = content.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  content = content.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

  // Convert code
  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Convert blockquotes
  content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");

  // Remove remaining HTML tags
  content = content.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  content = decodeHtmlEntities(content);

  // Clean up whitespace
  content = content.replace(/\n{3,}/g, "\n\n");
  content = content.replace(/[ \t]+/g, " ");
  content = content.trim();

  return content;
}

/**
 * Extract metadata from HTML
 */
export function extractMetadata(html: string): {
  title?: string;
  description?: string;
  author?: string;
  publishedAt?: string;
} {
  const metadata: {
    title?: string;
    description?: string;
    author?: string;
    publishedAt?: string;
  } = {};

  // Title
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  if (titleMatch) {metadata.title = decodeHtmlEntities(titleMatch[1].trim());}

  // Meta description
  const descMatch = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (descMatch) {metadata.description = decodeHtmlEntities(descMatch[1]);}

  // OG description fallback
  if (!metadata.description) {
    const ogDescMatch = /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(html);
    if (ogDescMatch) {metadata.description = decodeHtmlEntities(ogDescMatch[1]);}
  }

  // Author
  const authorMatch = /<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (authorMatch) {metadata.author = decodeHtmlEntities(authorMatch[1]);}

  // Published date
  const dateMatch = /<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (dateMatch) {metadata.publishedAt = dateMatch[1];}

  return metadata;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCharCode(parseInt(num, 10)));
}
