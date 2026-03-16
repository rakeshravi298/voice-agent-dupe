/**
 * Show Alert Box Tool
 * Displays a browser alert dialog with a custom message
 */
class ShowAlertTool extends FunctionCallDefinition {
  constructor() {
    super(
      "show_alert",
      "Displays an alert dialog box with a message to the user",
      {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to display in the alert box"
          },
          title: {
            type: "string",
            description: "Optional title prefix for the alert message"
          }
        }
      },
      ["message"]
    );
  }

  functionToCall(parameters) {
    const message = parameters.message || "Alert!";
    const title = parameters.title;

    // Construct the full alert message
    const fullMessage = title ? `${title}: ${message}` : message;

    // Show the alert
    alert(fullMessage);

    console.log(`  Alert shown: ${fullMessage}`);
  }
}
/**
 * Add CSS Style Tool
 * Injects CSS styles into the current page with !important flag
 */
class AddCSSStyleTool extends FunctionCallDefinition {
  constructor() {
    super(
      "add_css_style",
      "Injects CSS styles into the current page with !important flag",
      {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector to target elements (e.g., 'body', '.class', '#id')"
          },
          property: {
            type: "string",
            description: "CSS property to set (e.g., 'background-color', 'font-size', 'display')"
          },
          value: {
            type: "string",
            description: "Value for the CSS property (e.g., 'red', '20px', 'none')"
          },
          styleId: {
            type: "string",
            description: "Optional ID for the style element (for updating existing styles)"
          }
        }
      },
      ["selector", "property", "value"]
    );
  }

  functionToCall(parameters) {
    const { selector, property, value, styleId } = parameters;

    // Create or find the style element
    let styleElement;
    if (styleId) {
      styleElement = document.getElementById(styleId);
      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
      }
    } else {
      styleElement = document.createElement('style');
      document.head.appendChild(styleElement);
    }

    // Create the CSS rule with !important
    const cssRule = `${selector} { ${property}: ${value} !important; }`;

    // Add the CSS rule to the style element
    if (styleId) {
      // If using an ID, replace the content
      styleElement.textContent = cssRule;
    } else {
      // Otherwise append to any existing content
      styleElement.textContent += cssRule;
    }

    console.log(`🎨 CSS style injected: ${cssRule}`);
    console.log(`   Applied to ${document.querySelectorAll(selector).length} element(s)`);
  }
}

/**
 * Search Health Records Tool
 * Semantically searches through indexed health documents and diet plans
 */
class SearchHealthRecordsTool extends FunctionCallDefinition {
  constructor() {
    super(
      "search_health_records",
      "Searches through the user's uploaded medical records, diet plans, and health history using semantic search. Use this when the user asks about their specific health history or previously provided documents.",
      {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The health-related query or topic to search for (e.g., 'What are my allergies?', 'Show me my last blood test results')"
          }
        }
      },
      ["query"]
    );
  }

  async functionToCall(parameters, context) {
    const { query } = parameters;
    const { userEmail, callId, client } = context;

    console.log(`🔍 Searching health records for: "${query}"`);

    try {
        const response = await fetch('/query_records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, userEmail })
        });

        const data = await response.json();
        const results = data.results || [];

        let toolResponse;
        if (results.length === 0) {
            toolResponse = "No relevant health records found for this query.";
        } else {
            toolResponse = "Relevant information found in your records:\n" + 
                results.map(r => `--- ${r.title} ---\n${r.content}`).join("\n\n");
        }

        // Send the response back to Gemini Live
        if (client && callId) {
            client.sendToolResponse(callId, { output: toolResponse });
            console.log("✅ Tool response sent to Gemini");
        }

        return toolResponse;
    } catch (error) {
        console.error("❌ Search Tool Error:", error);
        if (client && callId) {
            client.sendToolResponse(callId, { error: error.message });
        }
    }
  }
}
