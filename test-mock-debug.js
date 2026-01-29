// Debug script to understand Jest mocking
const { jest } = require('@jest/globals');

// Create a mock function
const mockFn = jest.fn();

console.log('1. Created mock function:', mockFn);
console.log('   Mock calls:', mockFn.mock.calls);

// Set implementation
mockFn.mockImplementation((a, b, callback) => {
  console.log('2. Mock implementation called with:', a, b);
  callback(null, 'success');
});

console.log('3. Set implementation');
console.log('   Mock calls:', mockFn.mock.calls);

// Call the mock
mockFn('arg1', 'arg2', (err, result) => {
  console.log('4. Callback called with:', err, result);
});

console.log('5. After mock call');
console.log('   Mock calls:', mockFn.mock.calls);
console.log('   Mock results:', mockFn.mock.results);
