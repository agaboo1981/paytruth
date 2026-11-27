import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@solana/wallet-adapter-react', () => ({
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  WalletProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useConnection: () => ({ connection: { rpcEndpoint: 'http://localhost:8899' } }),
  useWallet: () => ({ connected: false, publicKey: null, signTransaction: undefined }),
}));
vi.mock('@solana/wallet-adapter-react-ui', () => ({
  WalletModalProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { PaytruthWalletProvider } from '../../src/react/index';

describe('PaytruthWalletProvider cluster guard', () => {
  it('refuses a mainnet endpoint', () => {
    const { render } = require('@testing-library/react') as typeof import('@testing-library/react');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <PaytruthWalletProvider endpoint="https://api.mainnet-beta.solana.com">
            <div>nope</div>
          </PaytruthWalletProvider>,
        ),
      ).toThrow(/mainnet/i);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('renders children for a devnet endpoint', () => {
    const { render } = require('@testing-library/react') as typeof import('@testing-library/react');
    const { getByText } = render(
      <PaytruthWalletProvider endpoint="https://api.devnet.solana.com">
        <div>ok</div>
      </PaytruthWalletProvider>,
    );
    expect(getByText('ok')).toBeTruthy();
  });
});
