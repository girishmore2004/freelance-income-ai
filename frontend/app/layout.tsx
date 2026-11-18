import './globals.css';
import { AppFrame } from './workspace-shell';

export const metadata = {
  title: 'Freelance Income AI — find freelance work and hire talent with AI assistance',
  description: 'An AI-assisted freelance marketplace: discover projects, draft proposals, hire freelancers and manage delivery, with a human decision at every step.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
