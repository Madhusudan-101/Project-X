import sys
import os

# Add the current directory to python path
sys.path.append(os.path.join(os.path.dirname(__file__)))

from app.deps import supabase
from app.crud import upsert_profile

def create_admin_user(email, password, name="Test User", role="candidate"):
    try:
        # Create user via Supabase Auth Admin API (automatically confirms email)
        res = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True
        })
        user = res.user
        if not user:
            print("Failed to create user: user not returned in response.")
            return
            
        print(f"Auth user created successfully with ID: {user.id}")
        
        # Create profile row in database
        profile = upsert_profile(user.id, {
            "email": email,
            "role": role,
            "name": name,
            "first_name": name.split()[0] if name else "",
            "last_name": name.split()[1] if name and len(name.split()) > 1 else "",
            "onboarded": True
        })
        if profile:
            print("Database profile created successfully!")
        else:
            print("Failed to create database profile.")
    except Exception as e:
        print(f"Error creating user: {e}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Create a test user bypassing email limits.")
    parser.add_argument("--email", default="testuser@gmail.com", help="User email")
    parser.add_argument("--password", default="password123", help="User password")
    parser.add_argument("--name", default="Test User", help="User name")
    parser.add_argument("--role", default="candidate", help="User role")
    
    args = parser.parse_args()
    create_admin_user(args.email, args.password, args.name, args.role)
