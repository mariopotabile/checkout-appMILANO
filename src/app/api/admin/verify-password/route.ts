// src/app/api/admin/verify-password/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    
    const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;
    
    if (!ADMIN_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Admin key non configurata' },
        { status: 500 }
      );
    }
    
    if (password === ADMIN_SECRET_KEY) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: 'Password non corretta' },
        { status: 401 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Errore server' },
      { status: 500 }
    );
  }
}
