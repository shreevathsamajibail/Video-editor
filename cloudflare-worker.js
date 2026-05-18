/**
 * VERSION: SAFE PARAMS
 * 
 * Paste this into Cloudflare Dashboard -> Workers
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (!env.AI) {
        return new Response(JSON.stringify({ error: "AI Binding 'AI' not found in Worker settings." }), { 
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      const body = await request.json().catch(() => ({}));
      const prompt = body.prompt;

      if (!prompt) {
        return new Response(JSON.stringify({ error: "Missing prompt" }), { 
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      console.log(`Generating: ${prompt}`);

      // Removing width, height, and num_steps to guarantee we don't send parameters it doesn't like.
      const binaryResult = await env.AI.run(
        "@cf/black-forest-labs/flux-1-schnell",
        { prompt: prompt }
      );

      // Handle the output which might be a uint8array, base64 string, or an object {image: "base64..."}
      if (binaryResult instanceof ArrayBuffer || binaryResult instanceof Uint8Array) {
        return new Response(binaryResult, {
          headers: { ...corsHeaders, "Content-Type": "image/png" }
        });
      } else if (typeof binaryResult === 'object' && binaryResult !== null) {
        // It's likely a JSON object like { image: "..." }
        return new Response(JSON.stringify(binaryResult), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } else if (typeof binaryResult === 'string') {
        // It could be a base64 string directly
        return new Response(binaryResult, {
          headers: { ...corsHeaders, "Content-Type": "text/plain" }
        });
      }

      // Fallback
      return new Response(binaryResult, {
        headers: {
          ...corsHeaders,
          "Content-Type": "image/png",
        },
      });

    } catch (err) {
      // Very safe error catching
      let errorMsg = "Unknown error";
      try {
        if (err && err.message) {
          errorMsg = String(err.message);
        } else if (err) {
          errorMsg = String(err);
        }
      } catch (e) { }

      return new Response(JSON.stringify({ error: errorMsg }), { 
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }
  }
};
