import { CardFactory, Attachment } from 'botbuilder';
import { TurnContext } from 'botbuilder';

export interface AuthCardOptions {
  userId: string;
  authUrl: string;
  title?: string;
  message?: string;
}

/**
 * Create an authentication card for users who need to connect their Odoo account
 */
export function createAuthCard(options: AuthCardOptions): Attachment {
  const { authUrl, title = 'Connect Your Odoo Account', message } = options;

  const defaultMessage = 'To log timesheets in Odoo, you need to connect your account. Click the button below to authenticate with Odoo.';

  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: title,
        weight: 'Bolder',
        size: 'Large',
        color: 'Accent'
      },
      {
        type: 'TextBlock',
        text: message || defaultMessage,
        wrap: true,
        spacing: 'Medium'
      },
      {
        type: 'TextBlock',
        text: 'What you can do after connecting:',
        weight: 'Bolder',
        spacing: 'Medium'
      },
      {
        type: 'FactSet',
        facts: [
          { title: '✓', value: 'Log timesheets with natural language' },
          { title: '✓', value: 'View your projects and tasks' },
          { title: '✓', value: 'Create new tasks on the fly' },
          { title: '✓', value: 'Timesheets attributed to your Odoo user' }
        ]
      }
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'Connect to Odoo',
        url: authUrl,
        style: 'positive'
      },
      {
        type: 'Action.Submit',
        title: 'Help',
        data: {
          action: 'help'
        }
      }
    ]
  });
}

/**
 * Create a success card shown after successful authentication
 */
export function createAuthSuccessCard(username: string): Attachment {
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: '✅ Connected Successfully',
        weight: 'Bolder',
        size: 'Large',
        color: 'Good'
      },
      {
        type: 'TextBlock',
        text: `Your Odoo account (${username}) is now connected to Teams.`,
        wrap: true
      },
      {
        type: 'TextBlock',
        text: 'You can now start logging timesheets! Try saying:',
        wrap: true,
        spacing: 'Medium'
      },
      {
        type: 'TextBlock',
        text: '"4 hours on Website project Homepage Redesign"',
        wrap: true,
        isSubtle: true,
        style: 'code'
      }
    ]
  });
}

/**
 * Create a re-authentication card for when the token has expired
 */
export function createReauthCard(authUrl: string): Attachment {
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: 'Session Expired',
        weight: 'Bolder',
        size: 'Large',
        color: 'Warning'
      },
      {
        type: 'TextBlock',
        text: 'Your Odoo session has expired or been invalidated. Please reconnect your account to continue logging timesheets.',
        wrap: true
      }
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'Reconnect to Odoo',
        url: authUrl,
        style: 'positive'
      }
    ]
  });
}

/**
 * Create a card showing current connection status
 */
export function createConnectionStatusCard(
  isConnected: boolean,
  username?: string,
  authUrl?: string,
  message?: string
): Attachment {
  if (isConnected && username) {
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.3',
      body: [
        {
          type: 'TextBlock',
          text: 'Account Connection Status',
          weight: 'Bolder',
          size: 'Medium'
        },
        {
          type: 'ColumnSet',
          columns: [
            {
              type: 'Column',
              width: 'auto',
              items: [
                {
                  type: 'TextBlock',
                  text: '🟢',
                  size: 'Large'
                }
              ]
            },
            {
              type: 'Column',
              width: 'stretch',
              items: [
                {
                  type: 'TextBlock',
                  text: 'Connected',
                  weight: 'Bolder',
                  color: 'Good'
                },
                {
                  type: 'TextBlock',
                  text: `Odoo User: ${username}`,
                  isSubtle: true,
                  spacing: 'None'
                },
                ...(message ? [{
                  type: 'TextBlock',
                  text: message,
                  wrap: true,
                  spacing: 'Small',
                  size: 'Small'
                } as any] : [])
              ]
            }
          ]
        }
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: 'Disconnect',
          data: {
            action: 'disconnect_odoo'
          },
          style: 'destructive'
        }
      ]
    });
  }

  // Not connected status
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: 'Account Connection Status',
        weight: 'Bolder',
        size: 'Medium'
      },
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [
              {
                type: 'TextBlock',
                text: '🔴',
                size: 'Large'
              }
            ]
          },
          {
            type: 'Column',
            width: 'stretch',
            items: [
              {
                type: 'TextBlock',
                text: 'Not Connected',
                weight: 'Bolder',
                color: 'Attention'
              },
              {
                type: 'TextBlock',
                text: message || 'Connect your Odoo account to log timesheets',
                isSubtle: true,
                spacing: 'None',
                wrap: true
              }
            ]
          }
        ]
      }
    ],
    actions: authUrl
      ? [
          {
            type: 'Action.OpenUrl',
            title: 'Connect to Odoo',
            url: authUrl,
            style: 'positive'
          }
        ]
      : []
  });
}

/**
 * Build the deep link URL for OAuth flow
 */
export function buildAuthUrl(
  baseUrl: string,
  userId: string,
  context: TurnContext
): string {
  const conversationRef = TurnContext.getConversationReference(context.activity);
  const encodedRef = encodeURIComponent(JSON.stringify(conversationRef));

  // Ensure baseUrl doesn't have trailing slash
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  return `${normalizedBaseUrl}/auth/oauth/start?userId=${encodeURIComponent(userId)}&conversationRef=${encodedRef}`;
}

/**
 * Create a card showing authentication options (API Key vs OAuth)
 */
export function createAuthOptionsCard(authUrl?: string): Attachment {
  const hasOAuth = !!authUrl;

  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: 'Connect Your Odoo Account',
        weight: 'Bolder',
        size: 'Large',
        color: 'Accent'
      },
      {
        type: 'TextBlock',
        text: 'Choose how you want to connect to Odoo:',
        wrap: true,
        spacing: 'Medium'
      },
      {
        type: 'Container',
        spacing: 'Medium',
        items: [
          {
            type: 'TextBlock',
            text: '🔑 Option 1: API Key (Recommended)',
            weight: 'Bolder',
            size: 'Medium'
          },
          {
            type: 'TextBlock',
            text: '• Works with all Odoo versions including Odoo Online\n• Generate an API Key in your Odoo profile\n• More secure for automation',
            wrap: true,
            isSubtle: true
          }
        ]
      },
      ...(hasOAuth ? [{
        type: 'Container',
        spacing: 'Medium',
        items: [
          {
            type: 'TextBlock',
            text: '🔐 Option 2: OAuth',
            weight: 'Bolder',
            size: 'Medium'
          },
          {
            type: 'TextBlock',
            text: '• Requires OAuth provider setup in Odoo\n• Single sign-on experience\n• Only works with Odoo.sh or self-hosted',
            wrap: true,
            isSubtle: true
          }
        ]
      }] : [{
        type: 'Container',
        spacing: 'Medium',
        items: [
          {
            type: 'TextBlock',
            text: '🔐 Option 2: OAuth (Not Available)',
            weight: 'Bolder',
            size: 'Medium',
            color: 'Attention'
          },
          {
            type: 'TextBlock',
            text: 'OAuth is not configured. Use API Key authentication instead.',
            wrap: true,
            isSubtle: true
          }
        ]
      }])
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: '🔑 Use API Key',
        data: {
          action: 'choose_api_key_auth'
        },
        style: 'positive'
      },
      ...(hasOAuth ? [{
        type: 'Action.OpenUrl',
        title: '🔐 Use OAuth',
        url: authUrl,
        style: 'default'
      }] : [])
    ]
  });
}

/**
 * Create an API Key input card for users to enter their Odoo API Key
 */
export function createApiKeyInputCard(message?: string): Attachment {
  const defaultMessage = 'To log timesheets in Odoo, you need to provide your API Key. You can generate an API Key in your Odoo profile under Account Security → API Keys.';

  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: 'Connect Your Odoo Account',
        weight: 'Bolder',
        size: 'Large',
        color: 'Accent'
      },
      {
        type: 'TextBlock',
        text: message || defaultMessage,
        wrap: true,
        spacing: 'Medium'
      },
      {
        type: 'Input.Text',
        id: 'odooUsername',
        label: 'Your Odoo Username (Email)',
        placeholder: 'Enter your Odoo email',
        isRequired: true,
        errorMessage: 'Username is required'
      },
      {
        type: 'Input.Text',
        id: 'apiKey',
        label: 'Your API Key',
        placeholder: 'Paste your API Key here',
        isRequired: true,
        style: 'password',
        errorMessage: 'API Key is required'
      },
      {
        type: 'TextBlock',
        text: 'How to get your API Key:\n1. Go to Odoo → Profile → Account Security\n2. Click "Manage API Keys"\n3. Create a new key named "Teams Bot"\n4. Copy and paste the key here',
        wrap: true,
        isSubtle: true,
        spacing: 'Medium',
        size: 'Small'
      }
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: 'Connect',
        data: {
          action: 'submit_api_key'
        },
        style: 'positive'
      }
    ]
  });
}

/**
 * Create a success card shown after successful API key authentication
 */
export function createApiKeySuccessCard(username: string): Attachment {
  return CardFactory.adaptiveCard({
    type: 'AdaptiveCard',
    version: '1.3',
    body: [
      {
        type: 'TextBlock',
        text: '✅ Connected Successfully',
        weight: 'Bolder',
        size: 'Large',
        color: 'Good'
      },
      {
        type: 'TextBlock',
        text: `Your Odoo account (${username}) is now connected to Teams.`,
        wrap: true
      },
      {
        type: 'TextBlock',
        text: 'You can now start logging timesheets! Try saying:',
        wrap: true,
        spacing: 'Medium'
      },
      {
        type: 'TextBlock',
        text: '"4 hours on Website project Homepage Redesign"',
        wrap: true,
        isSubtle: true,
        style: 'code'
      }
    ]
  });
}
