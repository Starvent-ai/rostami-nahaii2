import type { HTMLAttributes } from 'react';
import './Card.css';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="card-header">
      <h3>{title}</h3>
      {action}
    </div>
  );
}
