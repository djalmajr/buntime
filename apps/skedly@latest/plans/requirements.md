# Skedly - Implementation Plans

## Requirements

Implement a scheduling system based on skedly-web and skedly-api with the following features:

### Core Features

1. **Authentication**
   - Email/password authentication
   - Social authentication (Google)
   - Session management

2. **User Management**
   - User profiles
   - Admin users
   - Regular users

3. **Business Management**
   - Business profiles
   - Business settings
   - Contact information

4. **Service Management**
   - Service catalog
   - Pricing
   - Duration settings

5. **Appointment Management**
   - Schedule appointments
   - View appointments
   - Cancel appointments
   - Reschedule appointments

## Implementation Status

### Completed
- Basic project structure following papiros pattern
- Client routes (index, sign-in, schedule)
- Server API routes (auth, v1)
- TypeScript configurations
- Build scripts

### TODO
- Implement authentication with better-auth
- Connect to database (libSQL via plugin-database)
- Implement full API endpoints
- Add UI components from skedly-web
- Integrate payment system (OpenPix)
- Add notification system (Telegram)
- Implement availability calendar
- Add admin dashboard

## Next Steps

1. Set up database schemas and migrations
2. Implement authentication flow
3. Create business management pages
4. Implement appointment booking flow
5. Add admin dashboard
6. Integrate payment processing
7. Add notifications
