'use client';

import ProfileForm from '@/components/ProfileForm';
import { User } from 'lucide-react';

export default function AdminProfilePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <User className="h-6 w-6 text-primary" />
        <h2 className="text-xl font-bold text-slate-100">Личный кабинет администратора</h2>
      </div>
      <ProfileForm />
    </div>
  );
}
