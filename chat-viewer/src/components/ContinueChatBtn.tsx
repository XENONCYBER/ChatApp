import React from 'react';
import { ExternalLink } from 'lucide-react';

interface ContinueChatBtnProps {
  url: string;
  siteName: string;
}

export const ContinueChatBtn: React.FC<ContinueChatBtnProps> = ({
  url,
  siteName,
}) => {
  if (!url) return null;

  const displaySite =
    siteName.charAt(0).toUpperCase() + siteName.slice(1);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-primary continue-chat-btn"
      title={`Continue this conversation on ${displaySite}`}
    >
      <span>Continue Chat on {displaySite}</span>
      <ExternalLink size={13} />
    </a>
  );
};
