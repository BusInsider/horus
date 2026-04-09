// Math tool - Mathematical calculations
import { Tool, ToolContext, ToolResult } from './types.js';

export const mathTool: Tool = {
  name: 'math',
  description: `Perform mathematical calculations.
Supports basic arithmetic, scientific functions, and complex expressions.`,
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "10!", "sin(pi/2)")',
      },
    },
    required: ['expression'],
  },

  async execute(args: { expression: string }, context: ToolContext): Promise<ToolResult> {
    try {
      // Whitelist allowed characters for safety
      const allowed = /^[0-9+\-*/().\s^%!&|<>==sinocstalgqrpePIE\[\],]+$/;
      if (!allowed.test(args.expression)) {
        return {
          ok: false,
          error: 'Expression contains invalid characters',
        };
      }

      // Replace common math functions with JavaScript equivalents
      let expr = args.expression
        .replace(/\^/g, '**')
        .replace(/pi/gi, 'Math.PI')
        .replace(/e(?![xp])/gi, 'Math.E')
        .replace(/sqrt\(/g, 'Math.sqrt(')
        .replace(/sin\(/g, 'Math.sin(')
        .replace(/cos\(/g, 'Math.cos(')
        .replace(/tan\(/g, 'Math.tan(')
        .replace(/log\(/g, 'Math.log(')
        .replace(/log10\(/g, 'Math.log10(')
        .replace(/log2\(/g, 'Math.log2(')
        .replace(/abs\(/g, 'Math.abs(')
        .replace(/floor\(/g, 'Math.floor(')
        .replace(/ceil\(/g, 'Math.ceil(')
        .replace(/round\(/g, 'Math.round(')
        .replace(/max\(/g, 'Math.max(')
        .replace(/min\(/g, 'Math.min(')
        .replace(/random\(\)/g, 'Math.random()')
        .replace(/pow\(/g, 'Math.pow(');

      // Handle factorial
      if (expr.includes('!')) {
        const factorial = (n: number): number => n <= 1 ? 1 : n * factorial(n - 1);
        const match = expr.match(/(\d+)!/);
        if (match) {
          const result = factorial(parseInt(match[1]));
          return {
            ok: true,
            content: `${args.expression} = ${result}`,
          };
        }
      }

      // Use Function constructor instead of eval for safer execution
      const fn = new Function(`return ${expr}`);
      const result = fn();
      
      return {
        ok: true,
        content: `${args.expression} = ${result}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Calculation error: ${error instanceof Error ? error.message : 'Invalid expression'}`,
      };
    }
  },
};
