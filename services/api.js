import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000'; // Base URL of your API

export const getUsers = async (branchName) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/users/listing/${branchName}`, {
      withCredentials: true, // Ensure cookies are sent with the request
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

export const getUserDetails = async (userId, branchName) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/users/view/${userId}/${branchName}`, {
      withCredentials: true, // Ensure cookies are sent with the request
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user details:', error);
    throw error;
  }
};