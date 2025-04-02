


export class FakerJSExpressionMocker {

    static fakerMockValues = new Map<string, string>([
        // Company related mocks
        ["${{ faker.company.name() }}", "Acme Corp"],
        ["${{ faker.company.catchPhrase() }}", "Innovative solutions"],
        
        // Lorem ipsum text mocks
        ["${{ faker.lorem.text(50) }}", "Lorem ipsum dolor sit amet, consectetur adipiscing elit."],
        ["${{ faker.lorem.paragraph() }}", "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris."],
        ["${{ faker.lorem.text(1000) }}", "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam auctor, nisl eget ultricies tincidunt, nisl nisl aliquam nisl, eget ultricies nisl nisl eget nisl. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."],
        
        // Internet related mocks
        ["${{ faker.internet.email() }}", "john.doe@example.com"],
        ["${{ faker.internet.url() }}", "https://example.com/users/johndoe"],
        
        // Phone numbers
        ["${{ faker.phone.number({style:'national'}) }}", "(555) 123-4567"],
        
        // Number related mocks
        ["${{ faker.number.int({min: 0, max: 999999}) }}", "42578"],
        ["${{ faker.finance.amount(0, 999999, 2) }}", "12345.67"],
        ["${{ faker.number.float({ min: 0, max: 99, precision: 0.01 }).toFixed(2) }}", "45.67"],
        
        // Date related mocks
        ["${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}", "2023-06-15"],
        ["${{ faker.date.between({ from: new Date('2023-01-01T00:00:00Z'), to: new Date() }).toISOString() }}", "2023-06-15T10:30:15.123Z"],
        ["${{ faker.date.between({ from: new Date('1970-01-01T00:00:00Z'), to: new Date('1970-01-01T23:59:59Z') }).toISOString().split('T')[1] }}", "14:35:22.000Z"],
        
        // Boolean mocks
        ["${{ faker.datatype.boolean() }}", "true"]

    ]);
      
    /**
     * Gets a mock value for a faker expression
     * @param expression The faker expression
     * @returns The corresponding mock value or an empty string if not found
     */
    static getMockValue(fakerJSExpression: string): string {

        // Try exact match first
        if (this.fakerMockValues.has(fakerJSExpression)) {
          return this.fakerMockValues.get(fakerJSExpression) || "";
        }
        
        // // If no exact match, try to find a partial match
        // // This helps with expressions that might have whitespace differences or minor variations
        // for (const [key, value] of fakerMockValues.entries()) {
        //   // Clean up expressions for comparison by removing whitespace
        //   const cleanKey = key.replace(/\s+/g, '');
        //   const cleanExpr = expression.replace(/\s+/g, '');
          
        //   if (cleanExpr === cleanKey) {
        //     return value;
        //   }
        // }
        
        // Handle expressions with dynamic parameters by checking for pattern matches
        // This is useful for expressions like faker.lorem.text() with different length parameters
        if (fakerJSExpression.includes("faker.lorem.text")) {
          return "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
        }
        
        if (fakerJSExpression.includes("faker.date.between")) {

          if (fakerJSExpression.includes("split('T')[0]")) {
            return "2023-06-15";
          } else if (fakerJSExpression.includes("split('T')[1]")) {
            return "14:35:22.000Z";
          } else {
            return "2023-06-15T10:30:15.123Z";
          }

        }
        
        // Default empty value if no match is found
        return "";

    }

}