import Parse from 'parse/node';;

interface SignUpResponse {
  success: boolean;
  newUser: {
    id: string;
    createdAt: string;
    sessionToken: string;
    username?: string;
    email?: string;
  };
}

interface AppleAuthData {
  id_token: string;
  code?: string;
  user?: string | {
    name?: {
      firstName?: string;
      lastName?: string;
    };
    email?: string;
  };
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  try {
    // Get signup data from request body
    const { email, password, userName, appleAuth } = await readBody(event);

    // If Apple authentication data is provided
    if (appleAuth) {
      const { id_token, code, user: appleUserData } = appleAuth as AppleAuthData;

      try {
        const response = await $fetch<SignUpResponse>(`${backendBaseUrl()}v1/auth/signUpUser`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            appleAuth: {
              id_token,
              code,
              user: appleUserData
            }
          })
        });

        if (!response.success) {
          throw new Error('Apple signup failed');
        }

        const newUser = response.newUser;

        // Set the Parse session cookie
        setCookie(event, 'parse.session', newUser.sessionToken, {
          path: '/',
          maxAge: 31536000, // 1 year
          sameSite: 'strict',
          secure: cookieSecure(),
          httpOnly: false
        });

        return {
          success: true,
          user: {
            id: newUser.id,
            email: newUser.email,
            name: newUser.username
          },
          sessionToken: newUser.sessionToken,
          isNewUser: true
        };
      } catch (fetchError: any) {
        // Handle backend API errors
        const errorData = fetchError.data || {};
        const statusCode = errorData.statusCode || fetchError.statusCode || 500;
        const errorCode = errorData.errorCode || 'UNKNOWN_ERROR';
        const statusMessage = errorData.statusMessage || fetchError.message || 'Apple signup failed';

        return {
          success: false,
          message: statusMessage,
          errorCode,
          statusCode
        };
      }
    }

    // Regular email/password signup
    const response = await $fetch<SignUpResponse>(`${backendBaseUrl()}v1/auth/signUpUser`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: email,
        email,
        password,
        name: userName
      })
    })

    if (!response.success) {
      throw new Error('Signup failed');
    }

    const newUser = response.newUser;

    return {
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email ?? email,
        name: userName
      },
      sessionToken: newUser.sessionToken
    }

  } catch (error: any) {
    console.error('Signup error:', error);
    return {
      success: false,
      message: error.message || 'An error occurred during signup'
    };
  }
});
